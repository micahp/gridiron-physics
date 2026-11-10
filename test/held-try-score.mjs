import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { touchdownScore } from '../web/score-animation.js';

// Synthetic: six at the touchdown, try held back; a plain six and non-touchdown plays are unchanged.
assert.deepEqual(touchdownScore({ away: 22, home: 22 }, { away: 22, home: 30 }, { outcome: { touchdown: true } }), { away: 22, home: 28 });
assert.deepEqual(touchdownScore({ away: 0, home: 3 }, { away: 0, home: 6 }, { outcome: { touchdown: true } }), { away: 0, home: 6 });
assert.deepEqual(touchdownScore({ away: 0, home: 3 }, { away: 0, home: 6 }, { outcome: { touchdown: false } }), { away: 0, home: 6 });

// Real film-room data: play 43 is a touchdown from [3,0] to [3,7]; its extra point (play 44) leaves the score at [3,7].
const game = JSON.parse(await readFile(new URL('../web/data/game.json', import.meta.url), 'utf8'));
const td = game.plays[43], xp = game.plays[44];
const held = touchdownScore({ away: game.plays[42].score[0], home: game.plays[42].score[1] }, { away: td.score[0], home: td.score[1] }, { outcome: { touchdown: !!td.td } });
assert.deepEqual([held.away, held.home], [3, 6], 'film room touchdown shows six, the extra point waits for the next play');
assert.deepEqual(xp.score, [3, 7], 'the extra-point play starts at the full score');
console.log('PASS: held try synthetic and real film-room touchdown');
