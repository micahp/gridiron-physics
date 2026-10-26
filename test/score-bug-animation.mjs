import assert from 'node:assert/strict';
import { animateScoreBug } from '../web/score-animation.js';

// Fake frame clock: each requestAnimationFrame runs on the next tick, 100 ms apart.
let clock = 0;
const frames = [];
globalThis.performance = { now: () => clock };
globalThis.requestAnimationFrame = (fn) => { frames.push(fn); };
globalThis.window = { matchMedia: () => ({ matches: false }) };
const runFrames = () => { while (frames.length) { clock += 100; frames.shift()(clock); } };

const classes = new Set();
const bugEl = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
const scoreEl = { textContent: '' };
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};

// Changed score: starts at the old value, ends at the new one, and flashes the team.
animateScoreBug(bugEl, scoreEl, 22, 28);
assert.equal(scoreEl.textContent, '22');
assert.ok(classes.has('scored'), 'the scoring team flashes');
runFrames();
assert.equal(scoreEl.textContent, '28', 'the tween ends on the new score');

// Unchanged score: no flash and no tween.
classes.clear();
animateScoreBug(bugEl, scoreEl, 28, 28);
assert.equal(scoreEl.textContent, '28');
assert.equal(classes.has('scored'), false);
assert.equal(frames.length, 0, 'nothing scheduled when the score is unchanged');

console.log('PASS: score tween ends on the new score and flashes only a changed team');
