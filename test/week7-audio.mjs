import test from 'node:test';
import assert from 'node:assert/strict';
import { FOOTBALL_SOUNDS, SUSPENDED_FOLEY, planFootballSound, FootballAudio } from '../web/audio-director.js';

const p = (overrides = {}) => ({
  type: 'scrimmage', kind: 'run', offense: 'BAL', defense: 'CIN',
  action: 'RUN', gain: 6, togo: 10, ...overrides,
});
const record = {
  t0: -1, hz: 2, frames: new Array(13), // duration 6 s
  events: [
    { type: 'hit', t: 0.4, closing: 5 },
    { type: 'tackle', t: 1.2, closing: 7 },
    { type: 'whistle', t: 2.0 },
  ],
};
test('generic snap and contact clips stay suspended while the recorded referee whistle plays', () => {
  const cues = planFootballSound(p(), record, 'BAL');
  assert.deepEqual([...SUSPENDED_FOLEY].sort(), ['hit1', 'hit2', 'snap']);
  assert.ok(cues.some(c => c.name === 'foot1'), 'keep walking and atmosphere');
  assert.ok(cues.some(c => c.name === 'whistle'), 'the recorded referee blast is audible again');
  assert.ok(cues.every(c => !SUSPENDED_FOLEY.has(c.name)));
  assert.ok(planFootballSound(p({touchdown:true}), record, 'BAL').some(c => c.name === 'bigCheer'));
});
test('home touchdown roars, away touchdown is a subdued reaction', () => {
  assert.ok(planFootballSound(p({touchdown:true}), record, 'BAL').some(c => c.name === 'bigCheer'));
  assert.ok(planFootballSound(p({touchdown:true}), record, 'CIN').some(c => c.name === 'boo'));
});
test('interceptions belong to defending team for home crowd reaction', () => {
  assert.ok(planFootballSound(p({interception:true}), record, 'CIN').some(c => c.name === 'bigCheer'));
  assert.ok(planFootballSound(p({interception:true}), record, 'BAL').some(c => c.name === 'boo'));
});
test('big gains trigger mild home cheer, not automatic TD roar', () => {
  const sounds = planFootballSound(p({gain:12}), record, 'BAL').map(c => c.name);
  assert.ok(sounds.includes('cheer'));
  assert.ok(!sounds.includes('bigCheer'));
});
test('text-only kicks keep crowd and the referee whistle but still no fake impact', () => {
  const sounds = planFootballSound({
    type: 'field_goal', good: true, offense: 'BAL', action:'FIELD GOAL GOOD',
  }, null, 'BAL').map(c => c.name);
  assert.ok(sounds.includes('bigCheer'));
  assert.ok(sounds.includes('whistle'), 'dead-ball whistle is a recorded referee blast');
  assert.ok(sounds.every(name => !SUSPENDED_FOLEY.has(name)));
});
test('unknown events do not generate unsourced audio', () => {
  assert.deepEqual(planFootballSound(null, null, 'BAL'), []);
  assert.equal(Object.keys(FOOTBALL_SOUNDS).length, 11);
});
test('audio starts disabled and can be planned without a browser', () => {
  const director = new FootballAudio('BAL');
  assert.equal(director.enabled, false);
  director.setPlay(p(), record);
  director.update(2, true);
  assert.ok(director.cues.length > 0);
  director.disable();
  assert.equal(director.enabled, false);
});
