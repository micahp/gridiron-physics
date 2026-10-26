import assert from 'node:assert/strict';
import { afterPlayEnd } from '../web/score-animation.js';

assert.equal(afterPlayEnd(3.325, 3.3), false, 'before the touchdown clock');
assert.equal(afterPlayEnd(3.325, 3.4), true, 'past the touchdown clock');
assert.equal(afterPlayEnd(null, 9), false, 'a play without an end time never flips');

// Playback at several speeds: the flag must flip once, at the crossing, and stay post-play to the end.
for (const speed of [0.25, 1, 4]) {
  const end = 3.325;
  let t = -0.9, flips = 0, last = false;
  for (let step = 0; step < 5000; step++) {
    t = Math.min(t + (1 / 60) * speed, 5);
    const now = afterPlayEnd(end, t);
    if (now !== last) { flips++; last = now; assert.ok(t > end, `flips after the end at speed ${speed}`); }
  }
  assert.equal(flips, 1, `one flip at speed ${speed}`);
  assert.equal(last, true, `post-play at the end at speed ${speed}`);
}
console.log('PASS: the post-play flag flips at the play end at every speed');
