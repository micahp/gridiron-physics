import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scoreDelta, scoreMoment, scoreShown, touchdownScore, tweenScore } from '../web/score-animation.js';
import { adaptLpGamePayload } from '../web/lp-game-record-adapter.js';
import { createWeek7StatisticalGame, simulateWeek7StatisticalPlay } from '../web/week7-statistical-model.js';

const play = { state_before: { away_score: 0, home_score: 7 }, state_after: { away_score: 7, home_score: 7 } };
assert.deepEqual(scoreDelta(play), { away: 7, home: 0 }, 'delta is post minus pre');
assert.deepEqual(scoreDelta({}), { away: 0, home: 0 }, 'missing states give no delta');

const record = { events: [{ t: 1.0, type: 'snap' }, { t: 4.2, type: 'touchdown' }, { t: 5.0, type: 'whistle' }] };
assert.equal(scoreMoment(record), 4.2, 'scoring moment is the touchdown event time');
assert.equal(scoreMoment({ events: [{ t: 1, type: 'whistle' }] }), null, 'no scoring event gives null');
assert.equal(scoreMoment({ events: [{ t: 2, type: 'fg_good' }] }), 2, 'field goals are scoring events too');

assert.deepEqual(scoreShown({ away: 0, home: 7 }, { away: 7, home: 7 }, 4.1, 4.2), { away: 0, home: 7 }, 'before the moment shows the pre-play score');
assert.deepEqual(scoreShown({ away: 0, home: 7 }, { away: 7, home: 7 }, 4.2, 4.2), { away: 7, home: 7 }, 'from the moment shows the post-play score');
assert.deepEqual(scoreShown({ away: 0, home: 7 }, { away: 7, home: 7 }, 9, null), { away: 0, home: 7 }, 'no moment never changes the score');

assert.equal(tweenScore(0, 7, 0), 0);
assert.equal(tweenScore(0, 7, 1), 7);
assert.equal(tweenScore(0, 7, 2), 7, 'progress is clamped');
let last = -1;
for (let i = 0; i <= 10; i++) {
  const v = tweenScore(0, 7, i / 10);
  assert.ok(v >= last && Number.isInteger(v), 'tween is monotonic and whole-number');
  last = v;
}

// A touchdown shows six points at the touchdown; the try is held back until the next play starts.
assert.deepEqual(touchdownScore({ away: 22, home: 22 }, { away: 22, home: 30 }, { outcome: { touchdown: true } }), { away: 22, home: 28 }, 'two-point try is held back');
assert.deepEqual(touchdownScore({ away: 9, home: 9 }, { away: 9, home: 16 }, { outcome: { touchdown: true } }), { away: 9, home: 15 }, 'extra point is held back');
assert.deepEqual(touchdownScore({ away: 0, home: 3 }, { away: 0, home: 6 }, { outcome: { touchdown: true } }), { away: 0, home: 6 }, 'a plain six is shown in full');
assert.deepEqual(touchdownScore({ away: 0, home: 3 }, { away: 0, home: 6 }, { outcome: { touchdown: false } }), { away: 0, home: 6 }, 'non-touchdown plays are untouched');

// Real touchdowns from the pinned game: the scoring moment must fall inside the replay window.
const payload = JSON.parse(await readFile(new URL('../docs/fixtures/pregame/game-kc-sea-seed8-blocked.json', import.meta.url), 'utf8'));
const adapted = adaptLpGamePayload(payload);
const game = createWeek7StatisticalGame(payload);
let checked = 0;
outer: for (const drive of adapted.drives) for (const ip of drive.plays) {
  const p = ip.source;
  const delta = scoreDelta(p);
  if (delta.away + delta.home < 6) continue;
  const replay = simulateWeek7StatisticalPlay(game, p);
  const rec = replay.record;
  const moment = scoreMoment(rec);
  const end = rec.t0 + (rec.frames.length - 1) / rec.hz;
  assert.ok(moment != null && moment >= rec.t0 && moment <= end, `play ${p.sequence}: moment ${moment} inside [${rec.t0}, ${end}]`);
  if (++checked >= 2) break outer;
}
assert.equal(checked, 2, 'found two real scoring plays');
console.log('PASS: score deltas, scoring moment, pre/post switch, tween, and two real touchdowns inside their replay windows');
