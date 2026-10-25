import assert from 'node:assert/strict';
import { simulatePassPlay } from '../engine/autonomous/passing.js';

// Catch opportunities are discrete, reach is physical, and defenders react to a thrown ball.
const configs = Array.from({ length: 120 }, (_, i) => ({
  seed: `contest-${i}`,
  front: i % 2 ? 'nickel_over' : 'nickel_under',
  coverage: i % 3 === 0 ? 'cover_3' : 'cover_1',
  direction: i % 2 ? 'left' : 'right',
  dir: i % 4 < 2 ? 1 : -1,
  los: 20 + ((i * 13) % 60),
  ballY: [23.583, 26.667, 29.75][i % 3],
}));

let contested = 0;
for (const cfg of configs) {
  const run = simulatePassPlay(cfg);
  assert.ok(run.resolved, `seed ${cfg.seed} resolves`);

  // One catch opportunity per pass: a failed contest must not roll again as the ball falls through the catch band.
  const contests = run.events.filter((e) => e.type === 'catch_contest').length;
  assert.ok(contests <= 1, `seed ${cfg.seed}: ${contests} contests in one pass`);
  if (contests) contested++;

  // A defender can only take the ball from inside the catch reach (planar yards, including player radius).
  for (const e of run.events) {
    if ((e.type === 'catch' || e.type === 'interception') && String(e.player_id).startsWith('D.')) {
      assert.ok(e.reach_yards <= 1.6, `seed ${cfg.seed}: defender took the ball from ${e.reach_yards} yd, outside reach`);
    }
  }

  // Defenders perceive a thrown ball only after a reaction delay (the shortest possible is 0.16 s).
  const thrown = run.events.find((e) => e.type === 'throw');
  if (thrown) {
    for (const e of run.events) {
      if (e.type === 'decision' && e.assignment === 'break on the thrown ball') {
        assert.ok(e.t >= thrown.t + 0.16 - 1e-6,
          `seed ${cfg.seed}: a defender broke on the ball ${(e.t - thrown.t).toFixed(3)} s after release`);
      }
    }
  }
}
assert.ok(contested > 0, 'some passes reach a contest');
console.log(`autonomous contest ok: ${contested} of ${configs.length} passes reached a contest; at most one contest per pass; defenders took the ball only from reach; no defender broke on the ball before its reaction delay`);
