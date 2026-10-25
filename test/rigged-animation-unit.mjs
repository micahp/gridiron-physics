import test from 'node:test';
import assert from 'node:assert/strict';
import { POSE, getRiggedAnimationSelection } from '../web/rigged-player.js';

test('each gameplay pose selects its authored FBX clip and loop policy', () => {
  const expected = [
    [POSE.STANCE, 'Idle', true],
    [POSE.RUN, 'Running in place', true],
    [POSE.BLOCK, 'Standing Block Idle Leaning Back', true],
    [POSE.DOWN, 'Stunned (Knocked Down)', false],
    [POSE.THROW, 'Quarterback Pass', false],
    [POSE.CATCH, 'Running in place', true],
    [POSE.KICK, 'Goalkeeper Drop Kick', false],
    [POSE.HOLD, 'Football Hike', false],
    [POSE.CELEBRATE, 'Fist Pump', false],
    [POSE.BACKPEDAL, 'Running Backward in place', true],
    [POSE.WRAP, 'Running To Tackle', false],
    [POSE.KNEEL, 'Idle', true],
  ];
  for (const [pose, clipName, loop] of expected) {
    assert.deepEqual(getRiggedAnimationSelection(pose, false), { clipName, loop });
  }
});

test('running with the ball uses the in-place ball-carry clip', () => {
  assert.deepEqual(getRiggedAnimationSelection(POSE.RUN, true), {
    clipName: 'Running While Holding Something', loop: true,
  });
});

test('unknown pose codes request procedural fallback', () => {
  assert.equal(getRiggedAnimationSelection(999, false), null);
});

test('a stationary runner waits in a stance instead of jogging in place', () => {
  assert.deepEqual(getRiggedAnimationSelection(POSE.RUN, false, 0), {
    clipName: 'Idle', loop: true,
  });
  assert.deepEqual(getRiggedAnimationSelection(POSE.BACKPEDAL, false, 0.1), {
    clipName: 'Idle', loop: true,
  });
});

test('the run clip returns as soon as the player is actually moving', () => {
  assert.deepEqual(getRiggedAnimationSelection(POSE.RUN, false, 4.2), {
    clipName: 'Running in place', loop: true,
  });
  assert.deepEqual(getRiggedAnimationSelection(POSE.RUN, true, 4.2), {
    clipName: 'Running While Holding Something', loop: true,
  });
});

test('a stationary ball carrier holds his stance rather than jogging', () => {
  assert.deepEqual(getRiggedAnimationSelection(POSE.RUN, true, 0.12), {
    clipName: 'Idle', loop: true,
  });
});
