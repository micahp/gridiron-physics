import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { routeOffsets, routeWaypoints, ROUTE_LIBRARY_VERSION } from '../engine/routes.js';
import { simulatePlay } from '../engine/play.js';

assert.equal(ROUTE_LIBRARY_VERSION, 'gridiron.routes.v1');
assert.deepEqual(routeOffsets('curl', -2), [[11, 0], [9.5, 1]]);
assert.deepEqual(routeWaypoints('out', 1, 2, (f, l) => [f, l]), [[11, 2], [11.5, 9]]);
assert.throws(() => routeOffsets('unknown', 0), /unsupported route/);

// These exact historical replay records were captured from commit 2851ffe.
const baseline = [
  [1, '652c22d93c75219fbeec7498401199a1e1385f13fbf09ad8546ba269d0cdf649'],
  [7, '57849046faf4fa5e0e9e3961f8662cfc66cf16a44f58a568c3f6daee616050c7'],
  [13, '1dc17c9312f013b828f12a07aa97b75d770e225c024625b45bbb03d63920eb70'],
  [154, 'd8a56af6a96525a748e92cd0db5a94c0e9db870f38c1b856f4a6b469a10c91d8'],
];
const game = JSON.parse(readFileSync(new URL('../web/data/game.json', import.meta.url)));
for (const [index, expected] of baseline) {
  const result = simulatePlay(game, game.plays[index]);
  const hash = createHash('sha256').update(JSON.stringify(result)).digest('hex');
  assert.equal(hash, expected, `historical replay changed at play ${index}`);
}
console.log('route geometry and four historical replay records unchanged');
