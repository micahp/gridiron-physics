import test from 'node:test';
import assert from 'node:assert/strict';
import { describeWeek7Play } from '../web/week7-play-description.js';

const players = {
  qb: { name: 'Quarterback Name' },
  rb: { name: 'Running Back Name' },
  wr: { name: 'Receiver Name' },
  cb: { name: 'Defender Name' },
};
const selection = {
  lineups: { offense: { QB: 'qb', RB: 'rb' } },
  play: { carrier: 'rb', target: 'wr', interceptor: 'cb' },
};
test('run names the same roster ball carrier used by 3D physics', () => {
  const p = { type: 'scrimmage', kind: 'run', action: 'RUN', gain: 8 };
  assert.equal(describeWeek7Play(p, selection, players).line, 'RUN · Running Back Name · 8 yd');
});
test('completed pass credits QB and catcher, including touchdown', () => {
  const p = { type: 'scrimmage', kind: 'pass', action: 'PASS COMPLETE', completed: true, gain: 22, touchdown: true };
  assert.equal(describeWeek7Play(p, selection, players).line,
    'PASS COMPLETE · Quarterback Name to Receiver Name · Touchdown · 22 yd');
});
test('incomplete pass names the intended target, not a catcher', () => {
  const p = { type: 'scrimmage', kind: 'pass', action: 'PASS INCOMPLETE', completed: false, gain: 0 };
  assert.equal(describeWeek7Play(p, selection, players).line,
    'PASS INCOMPLETE · Quarterback Name intended for Receiver Name');
});
test('interception includes selected defensive player', () => {
  const p = { type: 'scrimmage', kind: 'pass', action: 'INTERCEPTION', completed: false, interception: true };
  assert.equal(describeWeek7Play(p, selection, players).line,
    'INTERCEPTION · Quarterback Name intended for Receiver Name · picked by Defender Name');
});
test('special teams never invents player IDs', () => {
  const p = { type: 'kickoff', action: 'KICKOFF', outcome: 'touchback' };
  assert.equal(describeWeek7Play(p, selection, players).line, 'KICKOFF · touchback');
});
test('unavailable roster selection falls back safely to event text', () => {
  const p = { type: 'scrimmage', kind: 'run', action: 'RUN', gain: -2 };
  assert.equal(describeWeek7Play(p, null, players).line, 'RUN · -2 yd');
  assert.equal(describeWeek7Play(p, { play: { carrier: 'missing' } }, players).line, 'RUN · -2 yd');
});
